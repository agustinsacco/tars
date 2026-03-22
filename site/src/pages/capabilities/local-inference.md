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

You can switch to local inference during the initial setup or by manually editing your environment.

#### 1. Using Tars Setup

Run the setup wizard and select "LlamaCpp" when prompted for the inference backend:

```bash
tars setup
```

#### 2. Manual Configuration

Add or update the following keys in your `~/.tars/.env` file:

```env
INFERENCE_BACKEND="llamacpp"
LOCAL_INFERENCE_URL="http://localhost:8080"
GEMINI_MODEL="llama3" # Defines the model requested from your local server
```

> [!WARNING]  
> **Crucial Router Decoupling:** When using local inference, you **must not** leave `GEMINI_MODEL` set to `auto` (the default). If set to `auto`, the internal Gemini SDK will attempt to ping Google's servers to calculate prompt complexity routing (which will fail with a 400 error if you don't have a valid Google API key). Specifying any concrete model name (like `llama3` or `local`) successfully forces the internal router to bypass Google and stream directly from your local hardware!

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
