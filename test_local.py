import threading
local_data = threading.local()
def get_service():
    if not hasattr(local_data, 'service'):
        local_data.service = "built"
        print("building new service")
    return local_data.service

def worker():
    get_service()
    get_service()

t1 = threading.Thread(target=worker)
t2 = threading.Thread(target=worker)
t1.start()
t2.start()
t1.join()
t2.join()
