import ftplib
import os

HOST = "ftpupload.net"
USER = "if0_41484516"
PASS = "nikgil1908"

def upload():
    try:
        ftp = ftplib.FTP(HOST)
        ftp.login(USER, PASS)
        ftp.set_pasv(True)
        ftp.cwd('htdocs')

        # Skip dev-only / dead files
        SKIP = {'admin.js', 'refactor_admin.py', 'admin-sidebar-plan.md'}
        
        for filename in os.listdir('frontend'):
            filepath = os.path.join('frontend', filename)
            if os.path.isfile(filepath) and filename not in SKIP and not filename.endswith('.py') and not filename.endswith('.md'):
                print(f"Uploading {filename}...")
                with open(filepath, 'rb') as f:
                    ftp.storbinary(f'STOR {filename}', f)
                    
        print("Upload complete!")
        ftp.quit()
    except Exception as e:
        print(f"FTP Error: {e}")

if __name__ == '__main__':
    upload()
