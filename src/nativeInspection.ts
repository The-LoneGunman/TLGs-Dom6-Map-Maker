import { ADVANCED_COMMANDS, inspectD6m } from "./dom6";

export const MAX_NATIVE_TEXT_BYTES = 16 * 1024 * 1024;
export const MAX_NATIVE_RASTER_BYTES = 40 * 1024 * 1024;
export interface NativeMapInspection {
  title?: string;
  image?: string;
  dimensions?: [number, number];
  declaredVersion?: number;
  provinceCount: number;
  namedProvinces: number;
  starts: number;
  specificStarts: number;
  neighbours: number;
  specialBorders: number;
  gateways: number;
  commanders: number;
  units: number;
  commands: Record<string, number>;
  unrecognized: string[];
  warnings: string[];
}

/** A bounded, read-only inventory, not an interpreter or a lossless map importer. */
export function inspectNativeMap(text: string): NativeMapInspection {
  if (text.length > MAX_NATIVE_TEXT_BYTES || new TextEncoder().encode(text).byteLength > MAX_NATIVE_TEXT_BYTES) throw new Error("Native map inspection is limited to 16 MiB.");
  const lines = text.replace(/^\uFEFF/, "").split(/\r\n?|\n/);
  if (lines.length > 200000) throw new Error("Native map inspection is limited to 200,000 lines.");
  // The help table abbreviates the magic-path family. Preserve underscores and
  // enumerate its middle entries instead of reporting our own exports as unknown.
  const recognized = new Set([
    ...ADVANCED_COMMANDS.flatMap(row => row.command.match(/#[a-z0-9_]+/g) ?? []),
    ...["fire", "air", "water", "earth", "astral", "death", "nature", "glamour", "blood", "priest"].map(path => `#mag_${path}`),
  ]);
  const result: NativeMapInspection = { provinceCount:0,namedProvinces:0,starts:0,specificStarts:0,neighbours:0,specialBorders:0,gateways:0,commanders:0,units:0,commands:{},unrecognized:[],warnings:[] };
  const terrainIds = new Set<number>(); const names = new Set<number>(); const starts = new Set<number>();
  const unsupported = new Set<string>(); const referenced = new Set<number>(); const commands = new Set<string>(); let firstCommand = "";
  const warn = (message: string) => { if (result.warnings.length < 100) result.warnings.push(message); };
  const province = (token: string | undefined, line: number): number | undefined => {
    const value = Number(token);
    if (!token || !/^\d{1,5}$/.test(token) || !Number.isSafeInteger(value) || value < 1 || value > 32767) { warn(`Line ${line}: invalid province number.`); return undefined; }
    referenced.add(value); return value;
  };
  for (let i=0; i<lines.length; i++) {
    const line = lines[i]!.trim(); if (!line.startsWith("#")) continue;
    if (line.length > 65536) throw new Error(`Line ${i+1} exceeds the inspection line limit.`);
    const tokens = tokenize(line, i+1); const command = tokens.shift()?.toLowerCase(); if (!command) continue;
    firstCommand ||= command;
    if (!/^#[a-z][a-z0-9_]{0,63}$/.test(command)) { warn(`Line ${i+1}: malformed command.`); continue; }
    commands.add(command);
    if (commands.size > 2048) throw new Error("Native map inspection is limited to 2,048 distinct directives.");
    result.commands[command] = (result.commands[command] ?? 0) + 1;
    if (!recognized.has(command)) unsupported.add(command);
    if (command === "#dom2title") result.title = tokens.join(" ").slice(0,4096);
    else if (command === "#imagefile") {
      result.image=tokens.join(" ").slice(0,4096);
      if (/[/\\]|^[a-z]+:/i.test(result.image)) warn(`Line ${i+1}: image reference includes a path; it is reported only and will not be opened.`);
    } else if (command === "#domversion") {
      result.declaredVersion=Number(tokens[0]);
      if (!/^\d{1,4}$/.test(tokens[0] ?? "") || result.declaredVersion < 1) warn(`Line ${i+1}: invalid #domversion.`);
    }
    else if (command === "#mapsize") {
      const width=Number(tokens[0]),height=Number(tokens[1]);
      if (!tokens.slice(0,2).every(v=>/^\d{1,5}$/.test(v)) || ![width,height].every(v=>Number.isSafeInteger(v)&&v>0&&v<=32767)) warn(`Line ${i+1}: invalid map dimensions.`);
      else result.dimensions=[width,height];
    } else if (command === "#terrain") {
      const id=province(tokens[0],i+1);
      if (id!==undefined) { if(terrainIds.has(id))warn(`Line ${i+1}: repeated terrain declaration for province ${id}.`);terrainIds.add(id); }
      if (!tokens[1] || !/^\d{1,20}$/.test(tokens[1]) || BigInt(tokens[1]) > 18446744073709551615n) warn(`Line ${i+1}: terrain mask is not an unsigned 64-bit integer.`);
    } else if (command === "#landname") { const id=province(tokens[0],i+1);if(id!==undefined)names.add(id); }
    else if (["#land","#setland","#nostart"].includes(command)) province(tokens[0],i+1);
    else if (["#start","#teamstart"].includes(command)) { const id=province(tokens[0],i+1);if(id!==undefined)starts.add(id); }
    else if (command === "#specstart") { result.specificStarts++;province(tokens[1],i+1); }
    else if (["#neighbour","#neighbourspec"].includes(command)) {
      province(tokens[0],i+1);province(tokens[1],i+1);
      if(command==="#neighbour")result.neighbours++;else result.specialBorders++;
    } else if (command === "#gate") { result.gateways++;province(tokens[0],i+1); }
    else if (command === "#commander") result.commanders++;
    else if (command === "#units" || command === "#bodyguards") {
      const count=Number(tokens[0]);if(/^\d{1,7}$/.test(tokens[0]??"")&&Number.isSafeInteger(count)&&count>=0&&count<=1000000)result.units+=count;else warn(`Line ${i+1}: invalid unit count.`);
    }
  }
  if(firstCommand!=="#dom2title")warn("The first directive is not #dom2title.");
  if(!result.image)warn("No #imagefile was found; geography has not been inspected.");
  if(result.declaredVersion!==undefined&&!Number.isSafeInteger(result.declaredVersion))warn("Invalid #domversion.");
  if(!terrainIds.size)warn("No #terrain records were found; province count cannot be established from this file.");
  for(const id of referenced)if(!terrainIds.has(id))warn(`Province ${id} is referenced without a terrain record. Inspect the image/native map and companion files.`);
  result.provinceCount=terrainIds.size;result.namedProvinces=names.size;result.starts=starts.size;result.unrecognized=[...unsupported].sort();
  return result;
}

function tokenize(line: string, number: number): string[] {
  const result: string[]=[];let token="",quoted=false,active=false;
  for(let i=0;i<line.length;i++){
    const c=line[i]!;
    if(c==='"'){quoted=!quoted;active=true;continue;}
    if(!quoted&&(line.slice(i,i+2)==="--"||line.slice(i,i+2)==="//"))break;
    if(!quoted&&/\s/.test(c)){if(active){result.push(token);token="";active=false;}continue;}
    token+=c;active=true;
  }
  if(quoted)throw new Error(`Line ${number}: unterminated quoted string. No directives were executed.`);
  if(active)result.push(token);return result;
}

export function inspectNativeRaster(data: Uint8Array): ReturnType<typeof inspectD6m> {
  if(data.byteLength>MAX_NATIVE_RASTER_BYTES)throw new Error("Raster inspection is limited to 40 MiB.");
  if(data.byteLength<38)throw new Error("D6M file is too short.");
  const view=new DataView(data.buffer,data.byteOffset,data.byteLength);
  const w=view.getInt32(8,true),h=view.getInt32(12,true),count=view.getInt32(30,true);
  if(w<=0||h<=0||w*h>8294400||count<1||count>32767)throw new Error("Raster header exceeds supported inspection bounds.");
  return inspectD6m(data);
}
