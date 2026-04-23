from services.providers.anthropic_adapter import AnthropicAdapter
from services.providers.perplexity_adapter import PerplexityAdapter
from services.providers.gemini_adapter import GeminiAdapter

ADAPTERS = {
    "anthropic": AnthropicAdapter(),
    "perplexity": PerplexityAdapter(),
    "gemini": GeminiAdapter(),
}
