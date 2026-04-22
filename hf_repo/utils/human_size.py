"""Single canonical implementation of human_size — imported by all modules."""


def human_size(num_bytes: int) -> str:
    """Convert bytes to human-readable string."""
    b = float(num_bytes)
    for unit in ('B', 'KB', 'MB', 'GB', 'TB'):
        if abs(b) < 1024.0:
            return f"{b:.1f} {unit}"
        b /= 1024.0
    return f"{b:.1f} PB"
