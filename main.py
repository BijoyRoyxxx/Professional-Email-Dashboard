from fastapi import FastAPI, UploadFile, File, Form, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import smtplib, os, csv, codecs
from email.message import EmailMessage
from dotenv import load_dotenv
from sqlalchemy import create_engine, Column, Integer, String, DateTime
from sqlalchemy.orm import sessionmaker, declarative_base
from datetime import datetime
from groq import Groq

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


# --- 2. CORE EMAIL LOGIC (UPGRADED FOR HTML) ---
def send_single_email(to_email: str, message_body: str, subject: str, cc_email: str = ""):
    msg = EmailMessage()
    msg['Subject'] = subject
    msg['From'] = os.getenv("EMAIL")
    msg['To'] = to_email
    if cc_email:
        msg['Cc'] = cc_email
        
    msg.set_content(message_body, subtype='html')

    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
        server.login(os.getenv("EMAIL"), os.getenv("PASS"))
        server.send_message(msg)


# --- 3. API ENDPOINTS ---
class EmailRequest(BaseModel):
    to_email: str
    cc_email: str = ""
    subject: str
    message: str

@app.post("/api/send")
def send_email(req: EmailRequest, db = Depends(get_db)):
    try:
        send_single_email(req.to_email, req.message, req.subject, req.cc_email)
        log = EmailLog(recipient=req.to_email, subject=req.subject, status="Success")
    except Exception as e:
        log = EmailLog(recipient=req.to_email, subject=req.subject, status=f"Failed: {str(e)}")
    
    db.add(log)
    db.commit()
    return {"status": "Complete"}

@app.post("/api/bulk-send")
async def bulk_send(
    file: UploadFile = File(...), 
    subject: str = Form(...),
    message: str = Form(...),
    db = Depends(get_db)
):
    csvReader = csv.DictReader(codecs.iterdecode(file.file, 'utf-8'))
    success_count = 0
    
    for row in csvReader:
        recipient = row.get('Email')
        if not recipient:
            continue
            
        custom_message = message
        custom_subject = subject
        for key, value in row.items():
            if key and value:
                custom_message = custom_message.replace(f"{{{key}}}", value)
                custom_subject = custom_subject.replace(f"{{{key}}}", value)
        
        try:
            send_single_email(recipient, custom_message, custom_subject)
            log = EmailLog(recipient=recipient, subject=custom_subject, status="Success")
            success_count += 1
        except Exception as e:
            log = EmailLog(recipient=recipient, subject=custom_subject, status="Failed")
            
        db.add(log)
        
    db.commit()
    return {"status": "Success", "emails_sent": success_count}

@app.get("/api/logs")
def get_logs(db = Depends(get_db)):
    return db.query(EmailLog).order_by(EmailLog.timestamp.desc()).limit(50).all()


# --- 4. AI CONFIGURATION (GROQ) ---
import re # NEW: Required to strip out AI thinking tags
groq_client = Groq(api_key=os.getenv("GROQ_API_KEY"))

class AIRequest(BaseModel):
    text_content: str

@app.post("/api/ai/draft")
def draft_reply(req: AIRequest):
    try:
        # FIX 1: Moved system instructions into the user prompt
        prompt = f"You are an expert copywriter. Write a concise, effective email draft formatted purely in HTML (use <br>, <b>, etc). Do NOT wrap your response in markdown code blocks or ```html.\n\nHere is the context to write about:\n{req.text_content}"
        
        chat_completion = groq_client.chat.completions.create(
            messages=[{"role": "user", "content": prompt}],
            model="openai/gpt-oss-20b",
            temperature=0.6,
            max_tokens=1000 # FIX 2: Increased so it has room to process logic
        )
        
        raw_draft = chat_completion.choices[0].message.content.strip()
        
        # FIX 3: Physically strip out the model's <think> tags if they leak into the text
        draft = re.sub(r'<think>.*?</think>', '', raw_draft, flags=re.DOTALL).strip()
        draft = draft.replace("```html", "").replace("```", "").strip()
        
        return {"draft": draft}
    except Exception as e:
        print(f"GROQ DRAFT ERROR: {e}")
        return {"draft": "Cloud API error. Check the Python terminal."}

@app.post("/api/ai/subject")
def generate_subject(req: AIRequest):
    try:
        # FIX 1: Moved system instructions into the user prompt
        prompt = f"You are a professional email copywriter. Your ONLY job is to write ONE short subject line (max 8 words) for the provided email body. Output the subject line ONLY. Do not use quotes, do not say 'Here is', and do not use the word 'Subject:'.\n\nEmail body:\n{req.text_content}"
        
        chat_completion = groq_client.chat.completions.create(
            messages=[{"role": "user", "content": prompt}],
            model="openai/gpt-oss-20b", 
            temperature=0.5, 
            max_tokens=300 # FIX 2: Increased so it doesn't get cut off mid-thought
        )
        
        raw_subject = chat_completion.choices[0].message.content.strip()
        
        # FIX 3: Strip out the reasoning process and clean up any loose punctuation
        clean_subject = re.sub(r'<think>.*?</think>', '', raw_subject, flags=re.DOTALL).strip()
        clean_subject = clean_subject.replace('"', '').replace('Subject:', '').replace('subject:', '').replace('*', '').strip()
        
        if not clean_subject:
            clean_subject = "Important Update"
            
        return {"subject": clean_subject}
    except Exception as e:
        print(f"GROQ SUBJECT ERROR: {e}")
        return {"subject": "Error generating subject"}