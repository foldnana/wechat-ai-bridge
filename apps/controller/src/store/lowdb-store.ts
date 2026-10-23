import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
export class LowDbStore<T> {
  private cache: T | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly schema: { parse(input: unknown): T },
    private readonly createDefault: () => T,
  ) {}

  read(): Promise<T> {
    return this.enqueue(() => this.readCurrent());
  }

  // Serialize the entire read/modify/write transaction, including first-use recovery.
  private enqueue<R>(operation: () => Promise<R>): Promise<R> {
    const result = this.writeQueue.then(operation);
    this.writeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async readCurrent(): Promise<T> {
    if (this.cache !== null) {
      return this.cache;
    }

    try {
      this.cache = await this.readAndParse(this.filePath);
      return this.cache;
    } catch (primaryError) {
      const backupPath = `${this.filePath}.bak`;
      let recovered: T;
      try {
        recovered = await this.readAndParse(backupPath);
      } catch (backupError) {
        if (
          (primaryError as NodeJS.ErrnoException).code !== "ENOENT" ||
          (backupError as NodeJS.ErrnoException).code !== "ENOENT"
        ) {
          throw new Error(
            "本机配置及备份无法读取，已保留原文件。请检查磁盘、目录权限或恢复有效备份。",
          );
        }
        recovered = this.createDefault();
      }
      const validated = this.schema.parse(recovered);
      await this.persist(validated);
      return validated;
    }
  }

  async write(nextValue: T): Promise<void> {
    const validated = this.schema.parse(nextValue);

    await this.enqueue(() => this.persist(validated));
  }

  async update(updater: (current: T) => T | Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      const current = await this.readCurrent();
      const nextValue = this.schema.parse(
        await updater(structuredClone(current)),
      );
      await this.persist(nextValue);
      return nextValue;
    });
  }

  private async persist(validated: T): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    const backupPath = `${this.filePath}.bak`;
    const payload = `${JSON.stringify(validated, null, 2)}\n`;
    await writeFile(tempPath, payload, "utf8");
    await writeFile(backupPath, payload, "utf8");
    await rename(tempPath, this.filePath);
    this.cache = validated;
  }

  private async readAndParse(filePath: string): Promise<T> {
    const raw = await readFile(filePath, "utf8");
    return this.schema.parse(JSON.parse(raw));
  }
}
