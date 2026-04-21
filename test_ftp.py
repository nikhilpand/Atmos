import ftplib

FTP_HOST = "ftpupload.net"
FTP_USER = "if0_41484516"
FTP_PASS = "nikgil1908"

ftp = ftplib.FTP(FTP_HOST)
ftp.login(FTP_USER, FTP_PASS)
print("Current dir:", ftp.pwd())
print("Dirs in root:")
ftp.dir()
print("\n--- trying to cd to htdocs ---")
try:
    ftp.cwd("htdocs")
    print("Success. Dirs in htdocs:")
    ftp.dir()
except Exception as e:
    print("Failed to cd htodcs:", e)
    
ftp.quit()
