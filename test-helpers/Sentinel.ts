export class Sentinel {
  public readonly resolve: () => void;
  private readonly promise: Promise<void>;
  public isResolved = false;

  constructor() {
    let res: () => void;
    this.promise = new Promise((resolve) => {
      res = resolve;
    });
    this.resolve = (...args) => {
      this.isResolved = true;
      res!(...args);
    };
  }

  public await = () => this.promise;
}
