---
layout: ../../layouts/DocLayout.astro
title: Local Inference (LlamaCpp)
description: How to configure Tars to use local models for 100% privacy.
section: Capabilities
---

Tars is designed to be flexible with its intelligence layer. While it uses Google's Gemini models by default for high-performance reasoning, you can configure it to use a local inference backend like **LlamaCpp** or any API that provides an OpenAI-compatible `/v1/chat/completions` endpoint.

### Why Local Inference?

- **100% Private**: Your data never leaves your machine.
- **Offline Capable**: Work without an internet connection.
- **Cost Control**: Avoid API usage fees for high-volume background tasks.
- **Model Choice**: Use specialized local models (e.g., Llama 3, Mistral, DeepSeek) for specific workflows.

### Configuration

You can enable local inference exclusively through the Tars CLI. Do not manually edit your environment files.

Run the setup wizard and select "LlamaCpp" when prompted for the inference backend:

```bash
tars setup
```

The wizard will explicitly guide you to configure:

1. **Inference Backend:** Select `llamacpp`.
2. **Endpoint URL:** Enter your server address (e.g., `http://localhost:8080`).
3. **Model Name:** Enter the exact model ID loaded (e.g., `llama3` or `qwen-35b`).

> [!WARNING]  
> **Crucial Router Decoupling:** When using local inference, you **must not** leave `GEMINI_MODEL` set to `auto` (the default). If set to `auto`, the internal Gemini SDK will attempt to ping Google's servers to calculate prompt complexity routing (which will fail with a 400 error if you don't have a valid Google API key). Specifying any concrete model name (like `llama3` or `local`) successfully forces the internal router to bypass Google and stream directly from your local hardware!

### Recommended Model Setup: Qwen

For optimal performance with Tars agentic tool-calling capabilities and complex routing, we highly recommend the **Qwen** series of models (specifically variants like `Qwen3.5-35B-A3B` / `30B MoE` or the highly efficient `Qwen3.5 9B Opus Instruct`).

These models are heavily optimized for coding, instruction following, and natively output extremely reliable strict JSON parameter payloads when utilizing Tars tools.

#### Example: Running Qwen via Llama.cpp

To boot the Qwen model on your local inference server (`stark:8086` for example), you can download the `.gguf` bindings (such as `Qwen3.5-35B-A3B-Q6_K.gguf`) from HuggingFace and run `llama-server` like this:

```bash
./llama-server -m models/Qwen3.5-35B-A3B-Q6_K.gguf --port 8086 --ctx-size 8192 --parallel 1
```

Then update your Tars configuration by running the interactive setup wizard:

```bash
tars setup
```

Select `LlamaCpp`, enter `http://stark:8086`, and provide the explicit model name (`qwen-35b`).

### Protocol Bridge

Tars uses a custom `LlamaCppGenerator` that acts as a bridge between the **Gemini CLI Core SDK** and your local provider. It handles the following translations automatically:

1. **Multi-Part Content**: Maps Gemini's complex part-based messages into the flat OpenAI message format.
2. **Tool Calling**: Translates Model Context Protocol (MCP) tool definitions into OpenAI function specs and routes responses back into the core loop.
3. **Token Estimation**: Provides heuristic-based token counting for local models that don't expose a dedicated endpoint.

### Supported Backends

Any backend that supports the OpenAI Chat Completions API will work, including:

- [Llama.cpp](https://github.com/ggerganov/llama.cpp) (using the `--server` mode)
- [Ollama](https://ollama.com/) (using the OpenAI compatibility layer)
- [LM Studio](https://lmstudio.ai/)
- [vLLM](https://github.com/vllm-project/vllm)

### Limitations

- **Embeddings**: Currently, semantic memory search still requires a Gemini embedding model or a locally configured alternative.
- **Multimodal**: Image and file attachments are currently optimized for Gemini and may have limited support depending on your local backend's vision capabilities.
