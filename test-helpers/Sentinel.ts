export class Sentinel<T = unknown> {
  public readonly resolve: (v: T) => void;
  private readonly promise: Promise<T>;
  public isResolved = false;

  constructor() {
    let res: (v: T) => void;
    this.promise = new Promise((resolve) => {
      res = resolve;
    });
    this.resolve = (v) => {
      this.isResolved = true;
      res!(v);
    };
  }

  public await = () => this.promise;
}
