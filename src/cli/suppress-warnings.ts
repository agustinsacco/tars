// Suppress SQLite experimental warnings early in the module resolution phase
process.on('warning', (warning) => {
    if (warning.name === 'ExperimentalWarning' && warning.message.includes('SQLite')) {
        return;
    }
    console.warn(warning.stack || warning.message);
});
