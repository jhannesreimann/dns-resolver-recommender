import logging
from abc import ABC, abstractmethod
from typing import Generic, TypeVar
import psycopg

logger = logging.getLogger(__name__)

_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS runs (
    id SERIAL PRIMARY KEY,
    timestamp TEXT NOT NULL,
    asn INTEGER,
    asn_org TEXT,
    country TEXT,
    browser_family TEXT,
    browser_major TEXT,
    os_family TEXT,
    browser_lang TEXT,
    total_resolvers INTEGER NOT NULL,
    cors_count INTEGER NOT NULL,
    opaque_count INTEGER NOT NULL,
    dead_count INTEGER NOT NULL,
    verified_dns_count INTEGER NOT NULL DEFAULT 0,
    verified_auth_count INTEGER NOT NULL DEFAULT 0,
    unverified_count INTEGER NOT NULL DEFAULT 0,
    paradox_count INTEGER NOT NULL DEFAULT 0,
    avg_cached_ms REAL,
    avg_uncached_ms REAL,
    client_http_version TEXT,
    client_ip_version INTEGER
);

CREATE TABLE IF NOT EXISTS measurements (
    id SERIAL PRIMARY KEY,
    run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    resolver_id TEXT NOT NULL,
    resolver_name TEXT NOT NULL,
    resolver_url TEXT NOT NULL,
    cached_avg_ms REAL,
    uncached_avg_ms REAL,
    score_ms REAL,
    cors INTEGER NOT NULL,
    dnssec INTEGER NOT NULL,
    no_logs INTEGER NOT NULL,
    no_filter INTEGER NOT NULL,
    resolver_country TEXT,
    verification_status TEXT,
    paradox INTEGER NOT NULL DEFAULT 0,
    cached_times TEXT,
    uncached_times TEXT,
    doh_http_version TEXT
);

CREATE INDEX IF NOT EXISTS idx_measurements_run ON measurements(run_id);
CREATE INDEX IF NOT EXISTS idx_measurements_resolver ON measurements(resolver_id);
CREATE INDEX IF NOT EXISTS idx_measurements_score ON measurements(score_ms);
CREATE INDEX IF NOT EXISTS idx_runs_timestamp ON runs(timestamp);
"""

class DatabaseParameters:
    def __init__(self, user: str, password: str, *, database = "postgres", port = 5432, host = "127.0.0.1", timeout = 10) -> None:
        self._user = user
        self._password = password
        self._port = port
        self._host = host
        self._timeout = timeout
        self._database = database

    def get_user(self):
        return self._user

    def get_password(self):
        return self._password

    def get_host(self):
        return self._host

    def get_port(self):
        return self._port

    def get_timeout(self):
        return self._timeout

    def get_database(self):
        return self._database

    def set_timeout(self, timeout: int):
        self._timeout = timeout

# This is the type of the connection of the database
ConnectionType = TypeVar('ConnectionType')

# Abstract Class for Databases
class TelemetryDatabase(ABC, Generic[ConnectionType]):
    @abstractmethod
    def __init__(self, parameters: DatabaseParameters) -> None:
        pass

    @abstractmethod
    def __str__(self) -> str:
        '''
        Some string representation of the database connection (e.g., connection string).
        '''
        pass

    @abstractmethod
    def connect(self) -> ConnectionType:
        '''
        Creates a connection to the database.
        '''
        pass

    @abstractmethod
    def initialize_database(self) -> bool:
        '''
        Returns True if the connection was successful and False if it was not successful
        '''
        pass


class PostgresDatabase(TelemetryDatabase[psycopg.Connection]):
    def __init__(self, parameters: DatabaseParameters) -> None:
        self._parameters = parameters
        self._logger = logging.getLogger("PostgreSQL Adapter")
        self._connection = None

    def connect(self) -> psycopg.Connection:
        CONNECT_TIMEOUT = 10

        POSTGRES_USER = self._parameters.get_user()
        POSTGRES_PASSWORD = self._parameters.get_password()
        POSTGRES_HOST = self._parameters.get_host()
        POSTGRES_DATABASE = self._parameters.get_database()
        POSTGRES_PORT = self._parameters.get_port()

        _conn_str = f'''
postgresql://{POSTGRES_USER}:{POSTGRES_PASSWORD}@{POSTGRES_HOST}/{POSTGRES_DATABASE}?application_name=dns_resolver_recommender&connect_timeout={CONNECT_TIMEOUT}&port={POSTGRES_PORT}
'''.strip()
        self._conn_str = _conn_str
        return psycopg.connect(_conn_str)

    def __str__(self) -> str:
        return self._conn_str

    def initialize_database(self) -> bool:
        db_conn = self.connect()
        db_conn.execute(_SCHEMA_SQL)
        # Migrations: add columns that may not exist in older databases
        for col, col_type in [
            ("client_http_version", "TEXT"),
            ("client_ip_version", "INTEGER"),
        ]:
            db_conn.execute(
                f"ALTER TABLE runs ADD COLUMN IF NOT EXISTS {col} {col_type}"
            )
        for col, col_type in [
            ("doh_http_version", "TEXT"),
        ]:
            db_conn.execute(
                f"ALTER TABLE measurements ADD COLUMN IF NOT EXISTS {col} {col_type}"
            )
        db_conn.commit()
        db_conn.close()
        return True
