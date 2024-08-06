const path = require('path');
const sharp = require('sharp');
const crypto = require('crypto');
const fs = require('fs').promises;

function createSharpPlugin(eleventyConfig, options = {}) {
    const pluginOptions = {
        outputDir: 'public/assets/images',
        urlPath: '/assets/images/',
        ...options
    };

    const imageCache = new Map();

    function hashConfig(config) {
        return crypto.createHash('md5').update(JSON.stringify(config)).digest('hex');
    }

    function ensureSharpConfig(input) {
        return typeof input === 'string' ? { inputPath: input, operations: [] } : input;
    }

    eleventyConfig.addFilter('sharp', (inputPath) => ({
        inputPath,
        operations: [],
        toString() { return JSON.stringify(this); }
    }));

    const sharpMethods = Object.getOwnPropertyNames(sharp.prototype)
        .filter(name => !name.startsWith('_') && name !== 'constructor');

    sharpMethods.forEach(method => {
        eleventyConfig.addFilter(method, (sharpConfig, ...args) => ({
            ...ensureSharpConfig(sharpConfig),
            operations: [...ensureSharpConfig(sharpConfig).operations, { method, args }],
            toString() { return JSON.stringify(this); }
        }));
    });

    eleventyConfig.addShortcode('getUrl', (sharpConfig) => {
        const config = ensureSharpConfig(sharpConfig);
        const configHash = hashConfig(config);
        const ext = path.extname(config.inputPath);
        const baseName = path.basename(config.inputPath, ext);
        const outputFileName = `${baseName}-${configHash}${ext}`;
        const outputPath = path.join(pluginOptions.urlPath, outputFileName);

        return `<!-- SHARP_IMAGE ${JSON.stringify(config)} -->${outputPath}`;
    });

    eleventyConfig.addTransform('sharpTransform', async (content, outputPath) => {
        if (!outputPath?.endsWith('.html')) return content;

        const regex = /<!-- SHARP_IMAGE (.*?) -->(.*?)(?=["'\s])/g;
        const promises = [];

        content = content.replace(regex, (match, configString, originalPath) => {
            const config = JSON.parse(configString);
            const ext = path.extname(config.inputPath);
            const baseName = path.basename(config.inputPath, ext);
            const configHash = hashConfig(config);
            const outputExt = config.operations[config.operations.length - 1]?.method === 'toFormat'
                ? `.${config.operations[config.operations.length - 1].args[0]}`
                : ext;

            const outputFileName = `${baseName}-${configHash}${outputExt}`;
            const outputPath = path.join(pluginOptions.urlPath, outputFileName);

            promises.push(processImage(config, outputFileName));

            return outputPath;
        });

        await Promise.all(promises);

        return content;
    });

    async function processImage(config, outputFileName) {
        const cacheKey = hashConfig(config);
        if (imageCache.has(cacheKey)) return;

        const outputFilePath = path.join(pluginOptions.outputDir, outputFileName);

        try {
            // Check if the file already exists
            await fs.access(outputFilePath);
            console.log(`Image already exists: ${outputFileName}`);
            imageCache.set(cacheKey, true);
        } catch (error) {
            // File doesn't exist, process it
            console.log(`Processing image: ${outputFileName}`);

            let pipeline = sharp(config.inputPath);
            config.operations.forEach(({ method, args }) => {
                pipeline = pipeline[method](...args);
            });

            await fs.mkdir(path.dirname(outputFilePath), { recursive: true });

            // Save to output directory
            await pipeline.toFile(outputFilePath);

            imageCache.set(cacheKey, true);
        }
    }

    // Ensure the output directory is created
    fs.mkdir(pluginOptions.outputDir, { recursive: true });

    return {
        // ... other plugin methods ...

        // Optional: Add a method to clear the output directory if needed
        clearOutputDir: async () => {
            imageCache.clear();
            await fs.rm(pluginOptions.outputDir, { recursive: true, force: true });
            await fs.mkdir(pluginOptions.outputDir, { recursive: true });
        }
    };
}

module.exports = createSharpPlugin;