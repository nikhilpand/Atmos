import os
import json
from google_auth_oauthlib.flow import InstalledAppFlow

# The exact path to your local downloaded OAuth client secret file
CLIENT_SECRET_FILE = "/home/nikhil/Downloads/client_secret_358991441057-sitr7588sj3ofkjbdu8uidsj4b0e21oq.apps.googleusercontent.com.json"
SCOPES = ['https://www.googleapis.com/auth/drive']

def main():
    if not os.path.exists(CLIENT_SECRET_FILE):
        print(f"❌ Error: Cannot find {CLIENT_SECRET_FILE}")
        return

    print("🌐 Opening your web browser to authenticate with Google...")
    
    # This will pop open a browser tab on your desktop.
    flow = InstalledAppFlow.from_client_secrets_file(
        CLIENT_SECRET_FILE, SCOPES
    )
    
    # Run local server on strict port 8080
    creds = flow.run_local_server(port=8080)

    # Save the generated credentials to token.json
    token_path = "token.json"
    with open(token_path, 'w') as token_file:
        token_file.write(creds.to_json())
        
    print(f"\n✅ SUCCESS! Your personal OAuth token has been saved to '{token_path}'")
    print("This token includes an infinite refresh token, allowing the bot to upload huge files directly using your 15GB+ storage quota.")

if __name__ == '__main__':
    main()
