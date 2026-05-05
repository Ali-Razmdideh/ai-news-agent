import logging
import os
import re
import json
from datetime import datetime, timezone


SECRET_PATTERNS = [
    (re.compile(r"sk-ant-[a-zA-Z0-9_-]{20,}"), "sk-ant-***"),
    (re.compile(r"\d{8,12}:[A-Za-z0-9_-]{30,}"), "tg-bot-***"),
    (re.compile(r"ghp_[A-Za-z0-9]{30,}"), "ghp_***"),
    (re.compile(r"pa-[A-Za-z0-9_-]{20,}"), "pa-***"),
]

SENSITIVE_KEYS = re.compile(r"token|secret|key|authorization", re.IGNORECASE)


def _redact(value):
    if isinstance(value, str):
        for pattern, repl in SECRET_PATTERNS:
            value = pattern.sub(repl, value)
        return value
    if isinstance(value, list):
        return [_redact(v) for v in value]
    if isinstance(value, dict):
        return {
            k: "***" if SENSITIVE_KEYS.search(k) else _redact(v)
            for k, v in value.items()
        }
    return value


class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        ts = datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat()
        obj: dict = {
            "time": ts,
            "level": record.levelname.lower(),
            "service": "ai-news",
            "msg": record.getMessage(),
        }
        # Extra fields attached via log.info({...}, msg) style
        for k, v in record.__dict__.items():
            if k not in ("name", "msg", "args", "levelname", "levelno", "pathname",
                         "filename", "module", "exc_info", "exc_text", "stack_info",
                         "lineno", "funcName", "created", "msecs", "relativeCreated",
                         "thread", "threadName", "processName", "process", "taskName",
                         "message"):
                obj[k] = _redact(v)
        if record.exc_info:
            obj["exc"] = self.formatException(record.exc_info)
        return json.dumps(obj)


class _Logger:
    """Thin wrapper that mimics pino's log.info({extra}, msg) call style."""

    def __init__(self):
        self._logger = logging.getLogger("ai-news")
        if not self._logger.handlers:
            handler = logging.StreamHandler()
            handler.setFormatter(_JsonFormatter())
            self._logger.addHandler(handler)
            self._logger.propagate = False
        level = os.environ.get("LOG_LEVEL", "info").upper()
        self._logger.setLevel(getattr(logging, level, logging.INFO))

    def _emit(self, level: int, args, kwargs):
        # Support both log.info(msg) and log.info({...}, msg)
        if len(args) == 2 and isinstance(args[0], dict):
            extra, msg = args
            record = self._logger.makeRecord(
                self._logger.name, level, "", 0, msg, (), None
            )
            for k, v in extra.items():
                setattr(record, k, v)
            self._logger.handle(record)
        elif args:
            self._logger.log(level, args[0], *args[1:], **kwargs)

    def debug(self, *args, **kwargs): self._emit(logging.DEBUG, args, kwargs)
    def info(self, *args, **kwargs): self._emit(logging.INFO, args, kwargs)
    def warn(self, *args, **kwargs): self._emit(logging.WARNING, args, kwargs)
    def warning(self, *args, **kwargs): self._emit(logging.WARNING, args, kwargs)
    def error(self, *args, **kwargs): self._emit(logging.ERROR, args, kwargs)


log = _Logger()
