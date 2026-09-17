import { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { getRecipe } from '../recipeApi.js';
import { formFromRecipe, publicationReadiness } from './recipeAuthoringModel.js';
import RecipeReview from './RecipeReview.jsx';
import './recipeAuthoring.css';

export default function RecipeDetailsModal({ recipeId, onClose }) {
  const [state, setState] = useState({ loading: true, recipe: null, error: '' });
  useEffect(() => { let active = true; getRecipe(recipeId).then((recipe) => { if (active) setState({ loading: false, recipe, error: '' }); }).catch((error) => { if (active) setState({ loading: false, recipe: null, error: error.message || 'Could not load recipe details.' }); }); return () => { active = false; }; }, [recipeId]);
  const form = state.recipe ? formFromRecipe(state.recipe) : null;
  return <div className="wc-author-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}><div className="wc-author-dialog wc-author-details-dialog" role="dialog" aria-modal="true" aria-labelledby="recipe-details-title"><header><div><span className="wc-author-kicker">Staff catalog</span><h1 id="recipe-details-title">Recipe details — read-only</h1></div><button type="button" className="wc-modal-close" aria-label="Close recipe details" onClick={onClose}><X size={19} /></button></header><main>{state.loading ? <p className="wc-author-muted">Loading latest recipe…</p> : state.error ? <div className="wc-author-error"><AlertTriangle size={17} />{state.error}</div> : <RecipeReview form={form} readiness={publicationReadiness(form)} recipeMeta={state.recipe} readOnly />}</main><footer><span /><button type="button" className="wc-btn-secondary" onClick={onClose}>Close</button></footer></div></div>;
}

