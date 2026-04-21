import requests

api_url = "https://nikhil1776-gdrivefwd.hf.space/api/videos/movies"
resp = requests.get(api_url, headers={"Authorization": "Bearer 1908"})
videos = resp.json().get("videos", [])
if not videos:
    print("No videos in movies, checking tv...")
    resp = requests.get("https://nikhil1776-gdrivefwd.hf.space/api/videos/tv", headers={"Authorization": "Bearer 1908"})
    videos = resp.json().get("videos", [])

if not videos:
    print("No videos found anywhere!")
    exit()

file_id = videos[0]["id"]
print(f"Using file_id: {file_id}")

url = f"https://nikhil1776-atmos-media.hf.space/stream/{file_id}"
headers = {"Range": "bytes=0-2097151"}
print("Request 1...")
r1 = requests.get(url, headers=headers, stream=True)
print("Status 1:", r1.status_code)
chunk1 = r1.raw.read()
print("Downloaded bytes 1:", len(chunk1))
r1.close()

headers = {"Range": "bytes=2097152-4194303"}
print("\nRequest 2...")
r2 = requests.get(url, headers=headers, stream=True)
print("Status 2:", r2.status_code)
chunk2 = r2.raw.read()
print("Downloaded bytes 2:", len(chunk2))
r2.close()

