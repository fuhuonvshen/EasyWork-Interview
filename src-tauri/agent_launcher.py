"""PyInstaller entry point for the EasyWork agent.
Sits outside the py_backend package so that relative imports in
py_backend.main work correctly when bundled by PyInstaller.
"""
import sys
import os

# Ensure py_backend package is importable
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

if __name__ == "__main__":
    # MUST be at the PyInstaller entry point: multiprocessing spawn children
    # relaunch this exe — without freeze_support() they would boot a second
    # uvicorn server instead of running the code executor's child target.
    import multiprocessing

    multiprocessing.freeze_support()
    import uvicorn
    from py_backend.config import AGENT_PORT
    from py_backend.main import app
    uvicorn.run(app, host="127.0.0.1", port=AGENT_PORT, log_level="info")
