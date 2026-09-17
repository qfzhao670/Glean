import os
import multiprocessing
if __name__ == '__main__':
    multiprocessing.freeze_support()
    import uvicorn
    from glean.app import app
    uvicorn.run(app, host='127.0.0.1', port=int(os.environ.get('GLEAN_PORT', '8765')), log_level='warning', access_log=False)
