import { describe, it, expect } from './runner.js';
import { parseLLMResponse, extractJsonBlock } from '../src/llm/responseParser.js';

describe('LLM / Response Parser', () => {
  it('parses pristine JSON response', () => {
    const raw = '{"narrative": "Você avança.", "commands": [{"type": "MOVE", "id": "player", "to": {"x": 3, "y": 2}}]}';
    const res = parseLLMResponse(raw);
    expect(res.ok).toBe(true);
    expect(res.payload.commands.length).toBe(1);
    expect(res.payload.narrative).toBe('Você avança.');
  });

  it('strips markdown code fences', () => {
    const fenced = '```json\n{\n  "narrative": "Fences test.",\n  "commands": []\n}\n```';
    const res = parseLLMResponse(fenced);
    expect(res.ok).toBe(true);
    expect(res.payload.narrative).toBe('Fences test.');
  });

  it('extracts JSON when surrounded by conversational chatter', () => {
    const chatter = 'Claro, aqui está o seu comando:\n\n{"narrative": "O goblin rosna.", "commands": []}\n\nEspero que ajude!';
    const res = parseLLMResponse(chatter);
    expect(res.ok).toBe(true);
    expect(res.payload.narrative).toBe('O goblin rosna.');
  });

  it('reports syntax error on malformed JSON', () => {
    const broken = '{"narrative": "Incompleto", "commands": [ {"type": "MOVE"';
    const res = parseLLMResponse(broken);
    expect(res.ok).toBe(false);
    expect(res.stage).toBe('json');
    expect(res.errors[0]).toContain('no JSON object found');
  });

  it('extracts balanced json object handling inner brackets and strings', () => {
    const text = 'foo { "a": "hello {world}", "b": [1, 2] } bar';
    const block = extractJsonBlock(text);
    expect(block).toBe('{ "a": "hello {world}", "b": [1, 2] }');
  });
});
