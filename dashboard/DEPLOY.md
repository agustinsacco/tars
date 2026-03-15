# PM2 Deployment for Tars Dash

1. **Build the application:**

    ```bash
    npm run build
    ```

2. **Start with PM2:**

    ```bash
    pm2 start server.js --name "tars-dash" --env production
    ```

3. **Save PM2 process list:**

    ```bash
    pm2 save
    ```

4. **Monitor logs:**
    ```bash
    pm2 logs tars-dash
    ```

## Requirements

- Node.js 18+ (20+ recommended for Next.js 15)
- PM2 installed globally: `npm i -g pm2`
- Ensure `.env` is configured with a strong `DASH_PASSWORD`.
