from fastapi import FastAPI, UploadFile, File, Form, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import os, csv, codecs, json
import urllib.request
from dotenv import load_dotenv
from sqlalchemy import create_engine, Column, Integer, String, DateTime
from sqlalchemy.orm import sessionmaker, declarative_base
from datetime import datetime
from groq import Groq

# System Architect: Bijoy Roy
# Load environment variables (.env file)
load_dotenv()

app = FastAPI()

# Allow React to communicate with this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173", 
        "http://localhost:5174",
        "https://professional-email-dashboard.vercel.app" # <-- Your live Vercel site!
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- 1. DATABASE SETUP ---
SQLALCHEMY_DATABASE_URL = "sqlite:///./campaigns.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class EmailLog(Base):
    __tablename__ = "email_logs"
    id = Column(Integer, primary_key=True, index=True)
    recipient = Column(String, index=True)
    subject = Column(String)
    status = Column(String)
    timestamp = Column(DateTime, default=datetime.now)

Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# --- 2. DATA MODELS ---
class EmailRequest(BaseModel):
    to_email: str
    cc_email: str = ""
    subject: str
    message: str

class AIDraftRequest(BaseModel):
    text_content: str

# --- 3. THE GOOGLE API BRIDGE (Bypassing Render Firewall) ---
GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyDlI2n4MgsyEIQTa5TfVgBDcUgM0DXF6VaPOizJrxOfd2wJuc7QNxy4fQp3HXyyen_/exec"

def send_email_via_google(to_email, cc_email, subject, message):
    data = {
        "to": to_email,
        "cc": cc_email,
        "subject": subject,
        "message": message
    }
    
    req = urllib.request.Request(GOOGLE_SCRIPT_URL, method="POST")
    req.add_header('Content-Type', 'application/json')
    data_bytes = json.dumps(data).encode('utf-8')
    
    try:
        response = urllib.request.urlopen(req, data=data_bytes)
        result = json.loads(response.read().decode('utf-8'))
        return result.get("status") == "Success"
    except Exception as e:
        print("API Error:", e)
        return False

# --- 4. ENDPOINTS ---
@app.post("/api/send")
def send_single_email(request: EmailRequest, db = Depends(get_db)):
    success = send_email_via_google(request.to_email, request.cc_email, request.subject, request.message)
    
    status = "Success" if success else "Failed: API Error"
    db_log = EmailLog(recipient=request.to_email, subject=request.subject, status=status)
    db.add(db_log)
    db.commit()
    
    if success:
        return {"message": "Email sent successfully!"}
    return {"error": "Failed to send email"}

@app.post("/api/bulk-send")
def send_bulk_emails(file: UploadFile = File(...), subject: str = Form(...), message: str = Form(...), db = Depends(get_db)):
    csvReader = csv.DictReader(codecs.iterdecode(file.file, 'utf-8'))
    
    for row in csvReader:
        personalized_msg = message
        for key, value in row.items():
            personalized_msg = personalized_msg.replace(f"{{{key}}}", value)
            
        recipient = row.get("Email") or row.get("email")
        if recipient:
            success = send_email_via_google(recipient, "", subject, personalized_msg)
            status = "Success" if success else "Failed: API Error"
            
            db_log = EmailLog(recipient=recipient, subject=subject, status=status)
            db.add(db_log)
            
    db.commit()
    return {"message": "Bulk campaign completed!"}

@app.get("/api/logs")
def get_logs(db = Depends(get_db)):
    return db.query(EmailLog).order_by(EmailLog.timestamp.desc()).all()

# --- 5. AI INTEGRATION (Ultimate Auto-Failover Loop) ---
client = Groq(api_key=os.environ.get("GROQ_API_KEY"))

def execute_groq_request(messages, max_tokens):
    """
    Fetches all active models, filters out gated/audio models, 
    and tries them one by one until a successful generation occurs.
    """
    # 1. Fetch live active models from Groq
    models_data = client.models.list().data
    
    # 2. Filter out audio models and gated/private models that require terms acceptance
    active_ids = [m.id for m in models_data if "whisper" not in m.id.lower() and "canopylabs" not in m.id.lower()]
    
    # 3. Create a priority queue (try the best, most reliable models first)
    preferred = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "llama3-8b-8192", "mixtral-8x7b-32768", "gemma2-9b-it"]
    ordered_models = [m for m in preferred if m in active_ids] + [m for m in active_ids if m not in preferred]
    
    # 4. Loop through models until one successfully works!
    for model_id in ordered_models:
        try:
            print(f"Attempting AI generation with engine: {model_id}...")
            return client.chat.completions.create(
                model=model_id,
                messages=messages,
                temperature=0.7,
                max_tokens=max_tokens,
            )
        except Exception as e:
            print(f"Engine {model_id} failed. Skipping to next available model... (Error: {e})")
            continue
            
    raise Exception("Critical Error: All available Groq AI engines failed to respond.")

@app.post("/api/ai/draft")
def generate_draft(req: AIDraftRequest):
    completion = execute_groq_request(
        messages=[
            {"role": "system", "content": "You are a professional email writer. Format the output in HTML (e.g. use <p>, <br>)."},
            {"role": "user", "content": req.text_content}
        ],
        max_tokens=1024
    )
    return {"draft": completion.choices[0].message.content}

@app.post("/api/ai/subject")
def generate_subject(req: AIDraftRequest):
    completion = execute_groq_request(
        messages=[
            {"role": "system", "content": "You are an expert copywriter. Generate ONE catchy, professional email subject line for the provided text. DO NOT put quotes around it. DO NOT say 'Here is the subject line'."},
            {"role": "user", "content": req.text_content}
        ],
        max_tokens=50
    )
    return {"subject": completion.choices[0].message.content.strip('"')}