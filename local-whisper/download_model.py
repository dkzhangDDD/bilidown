from whisper_runtime import MODEL_NAME, load_whisper_model


if __name__ == "__main__":
    model, device, compute_type = load_whisper_model()
    print(
        f"Model ready: {MODEL_NAME} device={device} "
        f"compute_type={compute_type}"
    )
