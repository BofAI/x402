"""
Logging configuration for X402
"""

import logging
import sys


def setup_logging(level: int = logging.INFO) -> None:
    """
    Configure logging with timestamp, file and line number information

    Args:
        level: Logging level (default: INFO)
    """
    # Create formatter with timestamp, file and line number
    formatter = logging.Formatter(
        fmt="%(asctime)s - %(levelname)-8s %(name)s %(filename)s:%(lineno)d %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # Configure root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(level)

    # Remove existing handlers to avoid duplicates
    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)

    # Add console handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(level)
    console_handler.setFormatter(formatter)
    root_logger.addHandler(console_handler)


def get_logger(name: str) -> logging.Logger:
    """
    Get a logger instance with the given name

    Args:
        name: Logger name (typically __name__)

    Returns:
        Logger instance
    """
    return logging.getLogger(name)
