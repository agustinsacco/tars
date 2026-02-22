import { MessageFormatter } from './src/discord/message-formatter';

const longText = 'a'.repeat(3000);
const chunks = MessageFormatter.split(longText, 1000);
console.log(`chunks.length: ${chunks.length}`);

const text = 'First paragraph.\n\n' + 'a'.repeat(1980) + '\n\nSecond paragraph.';
const chunks2 = MessageFormatter.split(text, 2000);
console.log(`chunks2.length: ${chunks2.length}`);

console.log(chunks2[0] === 'First paragraph.\n\n' + 'a'.repeat(1980));
console.log(chunks2[1] === 'Second paragraph.');
