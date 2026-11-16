import os
import smtplib
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText


def send_automated_email():
    sender_email = os.getenv("SMTP_EMAIL")
    app_password = os.getenv("SMTP_APP_PASSWORD")
    receiver_email = os.getenv("SMTP_RECEIVER_EMAIL")

    if not sender_email or not app_password or not receiver_email:
        raise RuntimeError(
            "Missing SMTP environment variables. Set SMTP_EMAIL, SMTP_APP_PASSWORD, and SMTP_RECEIVER_EMAIL."
        )

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
        server.starttls()  # Encrypt the connection
        server.login(sender_email, app_password)
        server.send_message(msg)
        server.quit()
        print("Success: Automated email sent!")
        return True
    except Exception as e:
        print(f"Error: {e}")
        return False


if __name__ == "__main__":
    send_automated_email()
