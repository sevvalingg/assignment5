# Şevval Boyraz, 2200004208
# Bonus 17: build with   docker build -t tasks-api .
FROM denoland/deno:2.6.3
WORKDIR /app

# Dependencies first: this layer is cached until deno.json or deno.lock change.
COPY deno.json deno.lock* ./
COPY src ./src
COPY drizzle ./drizzle
RUN deno cache src/main.ts

# The database lives on a volume mounted at /data, owned by the non-root user.
RUN mkdir /data && chown deno:deno /data
USER deno
ENV DATABASE_URL=file:/data/tasks.db PORT=8000 APP_ENV=development
EXPOSE 8000

# --allow-net: listen on the port   --allow-env: read the configuration
# --allow-read/--allow-write: the SQLite file   --allow-ffi: libSQL's native library
# --allow-sys: libSQL asks for the OS name to load the right native library
CMD ["run", "--allow-net", "--allow-env", "--allow-read", "--allow-write", "--allow-ffi", "--allow-sys", "src/main.ts"]
