import { GatewayIntentBits } from 'discord.js';

console.log('GatewayIntentBits:');
for (const [key, value] of Object.entries(GatewayIntentBits)) {
    if (isNaN(Number(key))) {
        console.log(`${key}: ${value}`);
    }
}
