import { WhatsAppChannel } from './src/channels/whatsapp/whatsapp-channel.js';
import { Config } from './src/config/config.js';
import logger from './src/utils/logger.js';

async function test() {
    console.log('Testing WhatsApp Channel...');
    const config = Config.getInstance();

    // Manually enable WhatsApp for testing if not enabled
    config.channels.whatsapp = {
        enabled: true,
        ownerNumber: '1234567890' // Dummy
    };

    const whatsapp = new WhatsAppChannel();
    console.log('Is Enabled:', whatsapp.isEnabled);

    try {
        console.log('Starting WhatsApp channel...');
        // whatsapp.start() is async and starts the connection
        await whatsapp.start();
        console.log('WhatsApp started successfully (connection initiated).');
    } catch (err) {
        console.error('FAILED TO START:', err);
    }
}

test().catch((err) => console.error('FATAL ERROR:', err));
