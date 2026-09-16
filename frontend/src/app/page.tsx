"use client";

import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Message = {
  role: "user" | "assistant";
  content: string;
  isError?: boolean;
};

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "Hello! I am Anya. How can I help you today?" }
  ]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = async (e?: React.FormEvent, retryMessage?: string) => {
    if (e) e.preventDefault();
    
    const userMessage = retryMessage || input.trim();
    if (!userMessage || isTyping) return;

    if (!retryMessage) {
      setInput("");
      setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    }
    
    setIsTyping(true);

    try {
      // Create a temporary message for the assistant
      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);
      
      const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://anya-worker.vksh1cool.workers.dev";
      const response = await fetch(`${API_URL}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ 
          prompt: userMessage,
          userId: "dummy-user-uuid" 
        }),
      });

      if (!response.ok) {
        throw new Error(`API returned status ${response.status}`);
      }
      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let buffer = "";

      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        
        if (value) {
          buffer += decoder.decode(value, { stream: true });
        }
        
        // Process buffer for complete messages
        let boundaryIndex;
        while ((boundaryIndex = buffer.indexOf("\n\n")) !== -1) {
          const chunk = buffer.substring(0, boundaryIndex);
          buffer = buffer.substring(boundaryIndex + 2);
          
          if (chunk.startsWith("data: ")) {
            const dataStr = chunk.substring(6);
            if (dataStr === "[DONE]") {
              done = true;
              break;
            }
            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.error) {
                throw new Error(parsed.error);
              }
              setMessages((prev) => {
                const newMessages = [...prev];
                const lastIdx = newMessages.length - 1;
                newMessages[lastIdx].content += parsed.text;
                return newMessages;
              });
            } catch (e) {
              if (e instanceof Error && e.message !== "Unexpected end of JSON input") {
                // If it's a backend-thrown streaming error
                throw e;
              }
              // Ignore partial JSON parses
            }
          }
        }
      }
    } catch (error) {
      console.error("Chat error:", error);
      setMessages((prev) => {
        const newMessages = [...prev];
        const lastIdx = newMessages.length - 1;
        newMessages[lastIdx].content = "Sorry, I encountered an error connecting to the AI. Please try again.";
        newMessages[lastIdx].isError = true;
        return newMessages;
      });
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <main className="flex h-screen flex-col items-center justify-between p-4 md:p-12 bg-gradient-to-br from-slate-900 to-slate-800 text-white font-sans">
      <div className="z-10 max-w-4xl w-full flex-col flex h-full">
        <div className="flex-none p-6 text-center">
          <h1 className="text-4xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400">
            Anya Intelligence
          </h1>
          <p className="text-slate-400 mt-2">Powered by Gemini 1.5 Flash on Cloudflare Edge</p>
        </div>

        <div className="flex-grow overflow-y-auto p-4 md:p-8 space-y-6 rounded-2xl bg-white/5 border border-white/10 shadow-2xl backdrop-blur-md mb-6 custom-scrollbar">
          {messages.map((msg, idx) => (
            <div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} animate-in slide-in-from-bottom-4 duration-300 ease-out`}>
              <div className={`max-w-[85%] md:max-w-[75%] rounded-2xl p-4 ${
                msg.role === 'user' 
                  ? 'bg-indigo-600 text-white rounded-br-none shadow-indigo-500/20 shadow-lg' 
                  : msg.isError 
                    ? 'bg-red-900/50 border-red-500/50 border text-white rounded-bl-none'
                    : 'bg-slate-700/80 text-slate-100 rounded-bl-none shadow-black/20 shadow-lg border border-slate-600'
              }`}>
                {msg.role === 'assistant' && !msg.isError && (
                  <div className="flex items-center mb-2">
                    <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-indigo-500 to-pink-500 flex items-center justify-center mr-2 shadow-sm">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-white"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                    </div>
                    <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Anya</span>
                  </div>
                )}
                <div className="leading-relaxed prose prose-invert max-w-none prose-p:leading-relaxed prose-pre:bg-slate-800/80 prose-pre:border prose-pre:border-slate-600">
                  {msg.role === 'assistant' ? (
                     <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {msg.content}
                     </ReactMarkdown>
                  ) : (
                     <div className="whitespace-pre-wrap">{msg.content}</div>
                  )}
                </div>
              </div>
              {msg.isError && (
                <button 
                  onClick={() => {
                    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user')?.content;
                    if (lastUserMessage) {
                      setMessages(messages.slice(0, -1)); // Remove the error message
                      handleSubmit(undefined, lastUserMessage);
                    }
                  }}
                  className="mt-2 text-xs text-red-400 hover:text-red-300 flex items-center gap-1 transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                  Retry Request
                </button>
              )}
            </div>
          ))}
          {isTyping && (
             <div className="flex justify-start animate-pulse">
             <div className="bg-slate-700/80 rounded-2xl rounded-bl-none p-4 flex items-center space-x-2 border border-slate-600">
               <div className="w-2 h-2 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '0ms' }}></div>
               <div className="w-2 h-2 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '150ms' }}></div>
               <div className="w-2 h-2 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '300ms' }}></div>
             </div>
           </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <form onSubmit={handleSubmit} className="flex-none w-full relative group">
          <div className="absolute -inset-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 rounded-xl blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200"></div>
          <div className="relative flex items-center bg-slate-800 rounded-xl overflow-hidden border border-slate-600 focus-within:border-indigo-400 transition-colors shadow-inner">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask Anya anything..."
              className="flex-grow bg-transparent text-white px-6 py-4 outline-none placeholder-slate-400"
              disabled={isTyping}
            />
            <button
              type="submit"
              disabled={!input.trim() || isTyping}
              className="mx-2 px-6 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg font-medium transition-all duration-200 shadow-md flex items-center gap-2"
            >
              <span>Send</span>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
