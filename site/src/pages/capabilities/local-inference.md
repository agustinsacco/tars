---
layout: ../../layouts/DocLayout.astro
title: Local & Custom Inference
description: How to configure Tars to use local or custom model providers.
section: Capabilities
---

Tars is designed to be model-agnostic. While it supports Google's Gemini models for high-performance cloud reasoning, you can easily configure it to use a local inference server or custom OpenAI-compatible proxy endpoints.

### Why Local or Custom Inference?

- **Privacy & Security**: Keep your data entirely within your local network or private infrastructure.
- **Offline Capabilities**: Run autonomous system checks and maintenance without active internet connections.
- **Cost Efficiency**: Avoid cloud API rate limits and execution fees for high-volume background tasks.
- **Customized/Specialized Models**: Run fine-tuned developer models (like Llama 3, Mistral, or Qwen) optimized for your local codebase.

### Configuration via Setup Wizard

You can configure your provider settings by running the interactive setup wizard:

```bash
tars setup
```

When prompted for the **AI Model Provider**, you can select:

1. **Local Stark**: Pre-configured to point to a local model endpoint at `http://stark:8086/v1` running the Qwen 3.6 model.
2. **Custom**: Provide any custom OpenAI-compatible endpoint URL (e.g., `http://localhost:8080/v1`) and custom model identifier.

The wizard will save your configuration directly to `~/.tars/config.json` and configure the Pi SDK defaults.

### Recommended Model Setup: Qwen

For optimal performance with Tars' autonomous tool-calling capabilities and complex routing, we highly recommend the **Qwen** series of models (specifically variants like `Qwen3.6-35B-A3B` / `30B MoE` or the highly efficient `Qwen3.5 9B Opus Instruct`).

These models are heavily optimized for coding, instruction following, and natively output extremely reliable strict JSON parameter payloads when executing TARS tools.

#### Example: Running Qwen via Llama.cpp

To boot a Qwen model on your local server, you can download the `.gguf` bindings from HuggingFace and run `llama-server` like this:

```bash
./llama-server -m models/Qwen3.5-35B-A3B-Q6_K.gguf --port 8086 --ctx-size 8192 --parallel 1
```

Once running, select the **Local Stark** or **Custom** provider option in `tars setup` and point it to your server endpoint.

### Supported Local Backends

Any inference engine exposing an OpenAI-compatible Chat Completions API is supported natively by the Pi Agent SDK:

- [Llama.cpp](https://github.com/ggerganov/llama.cpp) (running in `--server` mode)
- [Ollama](https://ollama.com/) (using its OpenAI compatibility layer)
- [LM Studio](https://lmstudio.ai/)
- [vLLM](https://github.com/vllm-project/vllm)

### Limitations

- **Embeddings**: Semantic search within local memory still utilizes a lightweight embedding model or a locally configured equivalent.
- **Multimodal**: Image and file attachments are optimized for cloud-supported multimodal APIs and may have limited functionality depending on your local backend's vision capabilities.
