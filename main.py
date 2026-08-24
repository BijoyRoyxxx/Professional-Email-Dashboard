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
from passlib.context import CryptContext

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
        "https://professional-email-dashboard.vercel.app" # <-- Your live Vercel site
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- 1. DATABASE & SECURITY SETUP ---
# Pull the secure URL from Render's environment variables. Fallback to local SQLite if not found.
DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./campaigns.db")

# Supabase sometimes gives 'postgres://', but SQLAlchemy requires 'postgresql://'
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

# SQLite needs special arguments, Postgres does not
if DATABASE_URL.startswith("sqlite"):
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
else:
    engine = create_engine(DATABASE_URL)
    
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
class EmailLog(Base):
    __tablename__ = "email_logs"
    id = Column(Integer, primary_key=True, index=True)
    recipient = Column(String, index=True)
    subject = Column(String)
    status = Column(String)
    timestamp = Column(DateTime, default=datetime.now)

class Admin(Base):
    __tablename__ = "admins"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    password_hash = Column(String)

Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Auto-Create Default Admin (Only runs if the database is empty)
def create_default_admin():
    db = SessionLocal()
    if not db.query(Admin).first():
        hashed_pw = pwd_context.hash("system_admin_2026")
        new_admin = Admin(username="bijoy", password_hash=hashed_pw)
        db.add(new_admin)
        db.commit()
    db.close()

create_default_admin()

# --- 2. DATA MODELS ---
class LoginRequest(BaseModel):
    username: str
    password: str

class EmailRequest(BaseModel):
    to_email: str
    cc_email: str = ""
    subject: str
    message: str

class AIDraftRequest(BaseModel):
    text_content: str

# --- 3. THE GOOGLE API BRIDGE (Firewall Bypass) ---
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
@app.post("/api/login")
def login(req: LoginRequest, db = Depends(get_db)):
    admin = db.query(Admin).filter(Admin.username == req.username).first()
    
    if not admin or not pwd_context.verify(req.password, admin.password_hash):
        return {"success": False, "error": "Unauthorized access detected."}
        
    return {"success": True, "message": "Access Granted"}

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
    models_data = client.models.list().data
    active_ids = [m.id for m in models_data if "whisper" not in m.id.lower() and "canopylabs" not in m.id.lower()]
    
    preferred = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "llama3-8b-8192", "mixtral-8x7b-32768", "gemma2-9b-it"]
    ordered_models = [m for m in preferred if m in active_ids] + [m for m in active_ids if m not in preferred]
    
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
            {"role": "system", "content": "You are a strict automated API. Return EXACTLY ONE short email subject line (maximum 8 words). Return NOTHING else. No explanations, no greetings, no HTML tags, and absolutely no quotation marks."},
            {"role": "user", "content": f"Generate a subject line for this text: {req.text_content}"}
        ],
        max_tokens=25 
    )
    
    clean_subject = completion.choices[0].message.content.replace('"', '').replace('\n', '').strip()
    
    return {"subject": clean_subject}