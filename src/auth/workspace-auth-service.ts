import { OAuth2Client } from 'google-auth-library';
import fs from 'fs/promises';
import path from 'path';
import logger from '../utils/logger.js';
import inquirer from 'inquirer';
import chalk from 'chalk';

export class WorkspaceOAuthService {
    private readonly credspath: string;
    private readonly clientId: string;
    private readonly clientSecret: string;
    private readonly redirectUri: string = 'http://localhost:32941';

    constructor(private readonly homeDir: string) {
        this.credspath = path.join(this.homeDir, '.gemini', 'google-workspace-creds.json');
        this.clientId = process.env.GOOGLE_WORKSPACE_CLIENT_ID || '';
        this.clientSecret = process.env.GOOGLE_WORKSPACE_CLIENT_SECRET || '';
    }

    public async isAuthenticated(): Promise<boolean> {
        try {
            await fs.access(this.credspath);
            return true;
        } catch {
            return false;
        }
    }

    public async login(): Promise<void> {
        if (!this.clientId || !this.clientSecret) {
            throw new Error(
                'Missing GOOGLE_WORKSPACE_CLIENT_ID or GOOGLE_WORKSPACE_CLIENT_SECRET in environment.'
            );
        }

        const oauth2Client = new OAuth2Client(this.clientId, this.clientSecret, this.redirectUri);

        const scopes = [
            'https://www.googleapis.com/auth/gmail.modify',
            'https://www.googleapis.com/auth/drive',
            'https://www.googleapis.com/auth/calendar',
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/documents',
            'https://www.googleapis.com/auth/tasks',
            'https://www.googleapis.com/auth/userinfo.email',
            'openid'
        ];

        const url = oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: scopes,
            prompt: 'consent'
        });

        console.log(chalk.cyan('\n  1. Open this URL in your browser:'));
        console.log(chalk.white(`\n  ${url}\n`));
        console.log(
            chalk.cyan('  2. Log in and copy the "code" parameter from the resulting URL.')
        );
        console.log(
            chalk.dim(
                '     (The page might fail to load, just look at the address bar for ?code=...)'
            )
        );

        const { code } = await inquirer.prompt([
            {
                type: 'input',
                name: 'code',
                message: '  Enter the authorization code:',
                validate: (input: string) => input.length > 10 || 'Please enter a valid code'
            }
        ]);

        try {
            const { tokens } = await oauth2Client.getToken(code);
            const creds = {
                client_id: this.clientId,
                client_secret: this.clientSecret,
                refresh_token: tokens.refresh_token,
                type: 'authorized_user'
            };

            await fs.mkdir(path.dirname(this.credspath), { recursive: true });
            await fs.writeFile(this.credspath, JSON.stringify(creds, null, 2));
            logger.info('✅ Google Workspace credentials saved.');
        } catch (error: any) {
            logger.error(`❌ Failed to exchange code for tokens: ${error.message}`);
            throw error;
        }
    }
}
