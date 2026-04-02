async function test() {
  const response = await fetch('http://localhost:3000/api/process-audio', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audioBase64: 'UklGRiYAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=', // Mock WAV
      mimeType: 'audio/wav'
    })
  });
  const data = await response.json();
  console.log(JSON.stringify(data, null, 2));
}

test().catch(console.error);
