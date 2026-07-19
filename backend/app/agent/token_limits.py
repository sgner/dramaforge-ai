"""Provider output limits used by Agent LLM calls."""

# DeepSeek-V4-Pro official maximum output length.
# max_tokens is an upper bound; it does not force every request to emit this many
# tokens. Short tasks still stop early on stop/tool-call.
DEEPSEEK_V4_PRO_MAX_OUTPUT_TOKENS = 384_000
