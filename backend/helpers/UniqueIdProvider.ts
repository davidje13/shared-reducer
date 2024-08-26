export class UniqueIdProvider {
  private readonly _shared = crypto.randomUUID().substring(0, 8);
  private _unique = 0;

  public get() {
    const id = this._unique;
    this._unique++;
    return `${this._shared}-${id}`;
  }
}
