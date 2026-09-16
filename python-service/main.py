from fastapi import FastAPI, UploadFile, File
import uvicorn

app = FastAPI(title="Anya Async Service")

@app.get("/health")
def health_check():
    return {"status": "ok"}

@app.post("/parse-document")
async def parse_document(file: UploadFile = File(...)):
    # Mock document parsing logic for chunking large context
    # Real implementation would use unstructured/LangChain here
    content = await file.read()
    file_size = len(content)
    
    # Mocking chunk generation
    chunks = [
        {"id": 1, "text": "This is chunk 1 of the parsed document..."},
        {"id": 2, "text": "This is chunk 2 of the parsed document..."}
    ]
    
    return {
        "filename": file.filename,
        "size_bytes": file_size,
        "chunks": chunks
    }

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
