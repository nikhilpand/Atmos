import os
import json
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

CREDENTIALS_FILE = "/home/nikhil/Downloads/gdrivefwd-68c8c2550309.json"
FOLDER_ID = "16kDGI-eI6ciuCuE1xlhTzN_vg4bhoKvG"
SCOPES = ['https://www.googleapis.com/auth/drive']

def run_test():
    print("1️⃣ Loading Credentials...")
    try:
        with open(CREDENTIALS_FILE, "r") as f:
            creds_dict = json.load(f)
        creds = service_account.Credentials.from_service_account_info(creds_dict, scopes=SCOPES)
        service = build('drive', 'v3', credentials=creds)
        print("✅ Authentication Successful!")
        print(f"Service Account Email: {creds_dict.get('client_email')}")
    except Exception as e:
        print(f"❌ Authentication Failed: {e}")
        return

    print("\n2️⃣ Checking Folder Access...")
    try:
        folder = service.files().get(fileId=FOLDER_ID, fields="id, name, capabilities").execute()
        print(f"✅ Folder Found! Name: '{folder.get('name')}'")
        if not folder.get('capabilities', {}).get('canAddChildren'):
            print("❌ Error: The service account can see the folder but DOES NOT have EDIT/WRITE permissions!")
            return
        else:
            print("✅ Service Account has Write Permissions to the folder.")
    except Exception as e:
        print(f"❌ Folder Access Failed: {e}")
        print("-> Did you forget to share the folder with the Service Account email as an 'Editor'?")
        return

    print("\n3️⃣ Testing Upload (1MB dummy file)...")
    try:
        with open("dummy_test.txt", "w") as f:
            f.write("A" * 1024 * 1024) # 1MB file

        file_metadata = {'name': 'dummy_test.txt', 'parents': [FOLDER_ID]}
        media = MediaFileUpload("dummy_test.txt", resumable=True)
        
        uploaded_file = service.files().create(
            body=file_metadata,
            media_body=media,
            fields='id'
        ).execute()

        print(f"✅ Upload Successful! File ID: {uploaded_file.get('id')}")
        
    except Exception as e:
        print(f"❌ Upload Failed: {e}")
    finally:
        if os.path.exists("dummy_test.txt"):
            os.remove("dummy_test.txt")

    print("\n4️⃣ Checking Storage Quota...")
    try:
        about = service.about().get(fields="storageQuota").execute()
        quota = about.get('storageQuota', {})
        used = int(quota.get('usage', 0))
        total = int(quota.get('limit', 0))
        print(f"✅ Storage Check: {used / (1024**3):.2f} GB used out of {total / (1024**3):.2f} GB total." if total else f"✅ Storage Check: {used / (1024**3):.2f} GB used.")
    except Exception as e:
        print(f"❌ Quota Check Failed: {e}")


if __name__ == "__main__":
    run_test()
