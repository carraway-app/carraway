#!/usr/bin/env python3
"""Run a local PostgreSQL client with credentials from a URL in the environment."""
import os
import sys
from urllib.parse import unquote, urlsplit

# libpq expands a URL passed with -d, but treats PGDATABASE as a literal name.
variable, client, *args = sys.argv[1:]
url = urlsplit(os.environ[variable])
authority = url.netloc
if url.password is not None:
    os.environ["PGPASSWORD"] = unquote(url.password)
    user, host = authority.rsplit("@", 1)
    authority = user.split(":", 1)[0] + "@" + host

options = []
for option in url.query.split("&"):
    name, _, value = option.partition("=")
    if unquote(name) == "password":
        os.environ["PGPASSWORD"] = unquote(value)
    elif option:
        options.append(option)

address = f"{url.scheme}://{authority}{url.path}"
if options:
    address += "?" + "&".join(options)
os.execvp(client, [client, "-d", address, *args])
