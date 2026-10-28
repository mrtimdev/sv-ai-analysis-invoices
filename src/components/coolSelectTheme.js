/**
 * Modern Select2-style theme and styles for react-select components.
 */
export const coolSelectStyles = {
  control: (base, state) => ({
    ...base,
    minHeight: '38px',
    height: '38px',
    borderRadius: '10px',
    borderColor: state.isFocused ? 'var(--accent, #0284c7)' : 'var(--line, #cbd5e1)',
    boxShadow: state.isFocused ? '0 0 0 3px rgba(2, 132, 199, 0.18)' : 'none',
    '&:hover': {
      borderColor: state.isFocused ? 'var(--accent, #0284c7)' : '#94a3b8',
    },
    background: '#ffffff',
    fontSize: '12.5px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  }),
  valueContainer: (base) => ({
    ...base,
    padding: '0 10px',
  }),
  indicatorsContainer: (base) => ({
    ...base,
    padding: '0 4px',
  }),
  indicatorSeparator: () => ({ display: 'none' }),
  dropdownIndicator: (base, state) => ({
    ...base,
    padding: '4px',
    color: state.isFocused ? 'var(--accent, #0284c7)' : '#94a3b8',
    transform: state.selectProps.menuIsOpen ? 'rotate(180deg)' : 'none',
    transition: 'transform 0.18s ease, color 0.18s ease',
    '&:hover': {
      color: 'var(--accent, #0284c7)',
    },
  }),
  clearIndicator: (base) => ({
    ...base,
    padding: '4px',
    color: '#94a3b8',
    '&:hover': { color: '#ef4444' },
  }),
  menu: (base) => ({
    ...base,
    borderRadius: '12px',
    boxShadow: '0 16px 36px rgba(15, 23, 42, 0.18), 0 0 0 1px rgba(0, 0, 0, 0.06)',
    zIndex: 99999,
    overflow: 'hidden',
    padding: '4px',
    fontSize: '12.5px',
    marginTop: '6px',
    background: '#ffffff',
    border: '1px solid var(--line, #e2e8f0)',
  }),
  menuPortal: (base) => ({
    ...base,
    zIndex: 99999,
  }),
  menuList: (base) => ({
    ...base,
    maxHeight: '260px',
    padding: '2px',
  }),
  option: (base, state) => ({
    ...base,
    borderRadius: '8px',
    margin: '2px 0',
    padding: '8px 12px',
    fontSize: '12.5px',
    fontWeight: state.isSelected ? 600 : 500,
    backgroundColor: state.isSelected
      ? 'var(--accent, #0284c7)'
      : state.isFocused
      ? '#f1f5f9'
      : 'transparent',
    color: state.isSelected ? '#ffffff' : 'var(--ink, #0f172a)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    '&:active': {
      backgroundColor: state.isSelected ? 'var(--accent, #0284c7)' : '#e2e8f0',
    },
  }),
  singleValue: (base) => ({
    ...base,
    color: 'var(--ink, #0f172a)',
    fontWeight: 600,
    fontSize: '12.5px',
  }),
  placeholder: (base) => ({
    ...base,
    color: '#94a3b8',
    fontSize: '12.5px',
  }),
  input: (base) => ({
    ...base,
    color: 'var(--ink, #0f172a)',
    fontSize: '12.5px',
    margin: 0,
    padding: 0,
  }),
};
