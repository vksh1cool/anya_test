import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './db/schema';

type Bindings = {
  DATABASE_URL: string;
  GEMINI_API_KEY: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// More restrictive CORS for production readiness
app.use('*', cors({
  origin: (origin) => {
    // In dev allow localhost, in prod allow exact pages domains
    if (!origin) return '*';
    if (origin.startsWith('http://localhost:')) return origin;
    if (origin.endsWith('.pages.dev')) return origin;
    return 'https://anya.pages.dev'; // Replace with exact prod URL if available
  },
  allowHeaders: ['Content-Type'],
  allowMethods: ['POST', 'GET', 'OPTIONS'],
}));

app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/api/chat', async (c) => {
  let prompt: string;
  let userId: string | undefined;

  try {
    const body = await c.req.json();
    prompt = body.prompt;
    userId = body.userId;
  } catch (err) {
    return c.json({ error: 'Invalid JSON payload' }, 400);
  }

  // Edge case: empty or massive prompt
  if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
    return c.json({ error: 'Prompt is required and cannot be empty' }, 400);
  }
  if (prompt.length > 20000) {
    return c.json({ error: 'Prompt is too long (limit: 20000 chars)' }, 400);
  }

  if (!c.env.GEMINI_API_KEY) {
    return c.json({ error: 'Server configuration error: missing API key' }, 500);
  }

  const genAI = new GoogleGenerativeAI(c.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash' });

  try {
    const result = await model.generateContentStream(prompt);
    
    // Log usage to database asynchronously without blocking response
    c.executionCtx.waitUntil((async () => {
      if (userId && c.env.DATABASE_URL) {
        try {
          const sql = neon(c.env.DATABASE_URL);
          const db = drizzle(sql);
          await db.insert(schema.usageLogs).values({
            userId,
            tokens: 'stream', 
          });
        } catch (dbError) {
          console.error("Failed to log usage:", dbError);
        }
      }
    })());

    return new Response(
      new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of result.stream) {
              const chunkText = chunk.text();
              controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ text: chunkText })}\n\n`));
            }
            controller.enqueue(new TextEncoder().encode(`data: [DONE]\n\n`));
          } catch (streamError) {
            console.error("Gemini stream error mid-flight:", streamError);
            const errorMsg = streamError instanceof Error ? streamError.message : 'Unknown streaming error';
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ error: errorMsg })}\n\n`));
          } finally {
            controller.close();
          }
        },
      }),
      {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      }
    );
  } catch (error) {
    console.error("Chat API Error during initialization:", error);
    return c.json({ error: 'Failed to initialize AI stream. Safety filter may have triggered.' }, 500);
  }
});

app.get('/api/user', (c) => {
  return c.json({ id: 'dummy-user-uuid', role: 'free' });
});

export default app;
