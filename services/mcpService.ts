
import { FunctionDeclaration, FunctionResponsePart, Type } from "@google/genai";

// Lightweight MCP Client for Browser (SSE Transport)
export class McpClient {
  private eventSource: EventSource | null = null;
  private postEndpoint: string | null = null;
  private _isConnected: boolean = false;
  private tools: any[] = [];

  constructor(private url: string) {}

  get isConnected() {
    return this._isConnected;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // 1. Establish SSE Connection
        this.eventSource = new EventSource(this.url);

        this.eventSource.onopen = () => {
          console.log("✅ [MCP] SSE Connection Open");
        };

        this.eventSource.onerror = (err) => {
          console.error("❌ [MCP] SSE Error", err);
          this._isConnected = false;
          // If we haven't resolved yet, reject
          if (!this.postEndpoint) reject(err);
        };

        // 2. Listen for 'endpoint' event to know where to send JSON-RPC
        this.eventSource.addEventListener("endpoint", async (event) => {
          this.postEndpoint = new URL(event.data, this.url).toString();
          console.log(`🔗 [MCP] POST Endpoint received: ${this.postEndpoint}`);
          
          try {
            await this.initialize();
            this._isConnected = true;
            resolve();
          } catch (e) {
            reject(e);
          }
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  disconnect() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this._isConnected = false;
    this.postEndpoint = null;
  }

  private async rpcRequest(method: string, params: any = {}) {
    if (!this.postEndpoint) throw new Error("MCP Client not initialized (no endpoint)");

    const response = await fetch(this.postEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method,
        params
      })
    });

    if (!response.ok) {
      throw new Error(`MCP RPC failed: ${response.statusText}`);
    }

    const data = await response.json();
    if (data.error) {
      throw new Error(`MCP Error: ${data.error.message}`);
    }
    return data.result;
  }

  private async initialize() {
    await this.rpcRequest("initialize", {
      protocolVersion: "0.1.0",
      capabilities: {},
      clientInfo: { name: "EagleAI", version: "1.0.0" }
    });
    await this.rpcRequest("notifications/initialized");
  }

  // Fetch tools from MCP and convert to Gemini format
  async getGeminiTools(): Promise<FunctionDeclaration[]> {
    const result = await this.rpcRequest("tools/list");
    this.tools = result.tools || [];

    // Map MCP Tools to Gemini FunctionDeclarations
    return this.tools.map((tool: any) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema // MCP inputSchema is compatible with OpenAPI/Gemini schema
    }));
  }

  async callTool(name: string, args: any): Promise<any> {
    console.log(`🛠️ [MCP] Calling tool: ${name}`, args);
    const result = await this.rpcRequest("tools/call", {
      name,
      arguments: args
    });
    return result.content;
  }
}
