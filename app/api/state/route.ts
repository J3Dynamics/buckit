import { NextRequest, NextResponse } from 'next/server';
import { getState, setState } from '@/lib/serverState';

export const dynamic = 'force-dynamic';

export async function GET() {
  const state = getState();
  return NextResponse.json(state, {
    headers: { 'Access-Control-Allow-Origin': '*' },
  });
}

export async function POST(req: NextRequest) {
  const data = await req.json();
  setState(data);
  return NextResponse.json({ ok: true }, {
    headers: { 'Access-Control-Allow-Origin': '*' },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
