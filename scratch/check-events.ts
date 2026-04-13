import { Client, GatewayIntentBits } from 'discord.js';

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

console.log('Available Events:');
// This is just a dummy to check if I can find them in the library
import { Events } from 'discord.js';
console.log('Events.ClientReady:', Events.ClientReady);
console.log('Events.MessageCreate:', Events.MessageCreate);
