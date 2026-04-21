"""Upload frontend files to InfinityFree via FTP."""
import ftplib
import os
import re

FTP_HOST = "ftpupload.net"
FTP_USER = "if0_41484516"
FTP_PASS = "nikgil1908"
LOCAL_DIR = "/home/nikhil/Desktop/jio-to-gdrive/frontend"
REMOTE_DIR = "/htdocs"


class FixedFTP(ftplib.FTP):
    """FTP subclass that handles servers responding with EPSV to PASV."""
    def makepasv(self):
        """Handle servers that reply with 229 (EPSV) to PASV command."""
        # Try PASV first
        resp = self.sendcmd('PASV')
        if resp.startswith('229'):
            # Server gave EPSV response to PASV, parse 229 format: (|||port|)
            m = re.search(r'\|\|\|(\d+)\|', resp)
            if m:
                port = int(m.group(1))
                host = self.sock.getpeername()[0]
                return host, port
        # Standard 227 response
        return ftplib.parse227(resp)


def upload():
    print(f"🔗 Connecting to {FTP_HOST}...")
    ftp = FixedFTP(FTP_HOST, timeout=30)
    ftp.login(FTP_USER, FTP_PASS)
    print(f"✅ Connected!")

    try:
        ftp.cwd(REMOTE_DIR)
    except:
        print(f"Could not cd to {REMOTE_DIR}, using root.")

    files = sorted(f for f in os.listdir(LOCAL_DIR) if os.path.isfile(os.path.join(LOCAL_DIR, f)))
    total = len(files)
    
    for i, filename in enumerate(files, 1):
        filepath = os.path.join(LOCAL_DIR, filename)
        size = os.path.getsize(filepath)
        print(f"📤 [{i}/{total}] {filename} ({size//1024}KB)...")
        try:
            with open(filepath, 'rb') as f:
                ftp.storbinary(f'STOR {filename}', f)
            print(f"   ✅ Done")
        except Exception as e:
            print(f"   ❌ Failed: {e}")

    print(f"\n🎉 Deployed {total} files to atmos.page.gd!")
    ftp.quit()

if __name__ == "__main__":
    upload()
