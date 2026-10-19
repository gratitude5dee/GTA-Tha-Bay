export {};
declare const telemetry: { emit(name: string, props?: object): void };
telemetry.emit('bogus.name', {});
