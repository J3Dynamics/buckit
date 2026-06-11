import { getState, addSseClient, removeSseClient } from '@/lib/serverState';

export const dynamic = 'force-dynamic';

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send current state immediately
      const initial = encoder.encode(`data: ${JSON.stringify(getState())}\n\n`);
      controller.enqueue(initial);

      addSseClient(controller);

      // Keepalive every 15s
      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'));
        } catch {
          clearInterval(keepalive);
          removeSseClient(controller);
        }
      }, 15000);

      // Cleanup on close
      const cleanup = () => {
        clearInterval(keepalive);
        removeSseClient(controller);
      };

      // Store cleanup so it can be called on abort
      (controller as unknown as { _cleanup: () => void })._cleanup = cleanup;
    },
    cancel() {
      // Called when client disconnects
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
