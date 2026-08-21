import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime

def send_automated_email():
    sender_email = "broy12345joy@gmail.com"
    # Paste your 16-character app password below (no spaces)
    app_password = "kckfaxxnridrofkk" 
    receiver_email = "br135813@gmail.com"
    
    # 1. Structure the Email
    msg = MIMEMultipart()
    msg['From'] = sender_email
    msg['To'] = receiver_email
    msg['Subject'] = f"Automated Update - {datetime.now().strftime('%Y-%m-%d')}"
    
    body = "Hello! This is your automated application running successfully from the cloud."
    msg.attach(MIMEText(body, 'plain'))
    
    # 2. Connect and Send
    try:
        # Connect to Gmail's SMTP server on port 587
        server = smtplib.SMTP('smtp.gmail.com', 587)
        server.starttls() # Encrypt the connection
        server.login(sender_email, app_password)
        
        server.send_message(msg)
        server.quit()
        print("Success: Automated email sent!")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    send_automated_email()