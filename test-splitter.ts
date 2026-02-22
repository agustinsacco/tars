import { MessageFormatter } from './src/discord/message-formatter';

const textWithCode = `Here is some text.
## Header
Let us look at some code:
\`\`\`typescript
function foo() {
    console.log("hello");
    // a very long line to ensure we split...
    // 1
    // 2
    // 3
    // 4
    // 5
    // 6
    // 7
    // 8
    // 9
    // 10
}
\`\`\`
And more text afterwards.
`;

const chunks = MessageFormatter.split(textWithCode, 60);

console.log(`Total chunks: ${chunks.length}`);
chunks.forEach((c, i) => {
    console.log(`--- CHUNK ${i} (length: ${c.length}) ---`);
    console.log(c);
});
