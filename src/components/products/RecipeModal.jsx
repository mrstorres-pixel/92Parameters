import React, { useEffect, useRef, useState } from "react";
import { Trash2, Plus } from "lucide-react";
import db from "../../db/database";
import Modal from "../common/Modal";
import { useToast } from "../common/Toast";
import "../../styles/recipe.css";

async function allRows(table, filters = []) {
  const result = [];
  for (let offset = 0; ; offset += 500) {
    const rows = await table.query({
      filters,
      orderBy: "id",
      limit: 500,
      offset,
      throwOnError: true,
    });
    result.push(...rows);
    if (rows.length < 500) return result;
  }
}
export default function RecipeModal({ product, onClose }) {
  const [data, setData] = useState({
    ingredients: [],
    inventory: [],
    linkedIngredients: [],
    linkedInventory: [],
  });
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [ingForm, setIngForm] = useState({ id: "", qty: "" }),
    [invForm, setInvForm] = useState({ id: "", qty: "" });
  const generation = useRef(0),
    toast = useToast();
  async function load() {
    const version = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const filters = [{ field: "productId", op: "eq", value: product.id }];
      const [ingredients, inventory, links, disposables] = await Promise.all([
        allRows(db.ingredients),
        allRows(db.inventory),
        allRows(db.productIngredients, filters),
        allRows(db.productInventory, filters),
      ]);
      if (version !== generation.current) return;
      const ingMap = new Map(ingredients.map((row) => [String(row.id), row])),
        invMap = new Map(inventory.map((row) => [String(row.id), row]));
      setData({
        ingredients,
        inventory,
        linkedIngredients: links.map((link) => ({
          ...link,
          name:
            ingMap.get(String(link.ingredientId))?.name ||
            `Missing ingredient #${link.ingredientId}`,
          unit: ingMap.get(String(link.ingredientId))?.unit || "",
        })),
        linkedInventory: disposables.map((link) => ({
          ...link,
          name:
            invMap.get(String(link.inventoryId))?.name ||
            `Missing inventory item #${link.inventoryId}`,
        })),
      });
    } catch (e) {
      if (version === generation.current)
        setError(e.message || "Could not load the complete recipe.");
    } finally {
      if (version === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    setIngForm({ id: "", qty: "" });
    setInvForm({ id: "", qty: "" });
    load();
    return () => {
      generation.current++;
    };
  }, [product.id]);
  async function mutate(action, message) {
    if (busy || loading || error) return;
    setBusy(true);
    try {
      await action();
      toast(message);
      await load();
    } catch (e) {
      toast(e.message || "Could not save the recipe.", "error");
    } finally {
      setBusy(false);
    }
  }
  const sections = [
    {
      title: "Raw Ingredients",
      options: data.ingredients,
      rows: data.linkedIngredients,
      form: ingForm,
      setForm: setIngForm,
      table: db.productIngredients,
      reference: "ingredientId",
      label: "Ingredient",
      kind: "ingredient",
    },
    {
      title: "Disposables (Inventory)",
      options: data.inventory,
      rows: data.linkedInventory,
      form: invForm,
      setForm: setInvForm,
      table: db.productInventory,
      reference: "inventoryId",
      label: "Inventory item",
      kind: "inventory item",
    },
  ];
  return (
    <Modal
      title={`Recipe: ${product.name}`}
      large
      onClose={onClose}
      footer={
        <button className="btn btn-primary" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="recipe-editor">
        {loading && <p role="status">Loading complete recipe…</p>}
        {error && (
          <div role="alert">
            <p>{error}</p>
            <button className="btn btn-secondary" onClick={load}>
              Retry recipe
            </button>
          </div>
        )}
        {!loading && !error && (
          <div className="recipe-panels">
            {sections.map((section) => (
              <section key={section.title}>
                <h3>{section.title}</h3>
                <div className="table-container">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>{section.label}</th>
                        <th>Qty</th>
                        <th>
                          <span className="report-sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {!section.rows.length && (
                        <tr>
                          <td colSpan={3}>
                            No{" "}
                            {section.kind === "ingredient"
                              ? "ingredients"
                              : "inventory"}{" "}
                            linked
                          </td>
                        </tr>
                      )}
                      {section.rows.map((row) => (
                        <tr key={row.id}>
                          <td>{row.name}</td>
                          <td className="recipe-quantity">
                            {row.quantity}
                            {row.unit ? ` ${row.unit}` : ""}
                          </td>
                          <td>
                            <button
                              className="btn btn-ghost btn-icon"
                              aria-label={`Remove ${row.name}`}
                              disabled={busy}
                              onClick={() =>
                                mutate(
                                  () => section.table.delete(row.id),
                                  "Link removed",
                                )
                              }
                            >
                              <Trash2 size={18} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <form
                  className="recipe-add"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!section.form.id || !(Number(section.form.qty) > 0))
                      return;
                    mutate(async () => {
                      await section.table.add({
                        productId: product.id,
                        [section.reference]: Number(section.form.id),
                        quantity: Number(section.form.qty),
                      });
                      section.setForm({ id: "", qty: "" });
                    }, "Recipe link added");
                  }}
                >
                  <label>
                    {section.label}
                    <select
                      className="form-select"
                      aria-label={section.label}
                      value={section.form.id}
                      disabled={busy}
                      onChange={(event) =>
                        section.setForm({
                          ...section.form,
                          id: event.target.value,
                        })
                      }
                    >
                      <option value="">Select…</option>
                      {section.options.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.name}
                          {row.unit ? ` (${row.unit})` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Qty
                    <input
                      aria-label={`${section.label} quantity`}
                      className="form-input"
                      type="number"
                      min="0"
                      step="any"
                      value={section.form.qty}
                      disabled={busy}
                      onChange={(event) =>
                        section.setForm({
                          ...section.form,
                          qty: event.target.value,
                        })
                      }
                    />
                  </label>
                  <button
                    className="btn btn-secondary"
                    aria-label={`Add ${section.kind}`}
                    disabled={
                      busy ||
                      !section.form.id ||
                      !(Number(section.form.qty) > 0)
                    }
                  >
                    <Plus size={18} />
                  </button>
                </form>
              </section>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
