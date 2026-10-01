import { useState, useRef, useEffect } from "react";

const INDIAN_CITIES = [
  "Agra","Ahmedabad","Ajmer","Aligarh","Allahabad","Amravati","Amritsar","Aurangabad",
  "Bareilly","Bengaluru","Bhopal","Bhubaneswar","Chandigarh","Chennai","Coimbatore",
  "Dehradun","Delhi","Dhanbad","Erode","Faridabad","Gandhinagar","Gangtok","Gaya",
  "Ghaziabad","Goa","Gorakhpur","Gurgaon","Guwahati","Gwalior","Hubli","Hyderabad",
  "Imphal","Indore","Itanagar","Jabalpur","Jaipur","Jalandhar","Jammu","Jamshedpur",
  "Jodhpur","Kanpur","Kochi","Kohima","Kolkata","Kota","Kozhikode","Lucknow","Ludhiana",
  "Madurai","Mangalore","Meerut","Mysore","Nagpur","Nainital","Nashik","Noida","Ooty",
  "Patiala","Patna","Pune","Raipur","Rajkot","Ranchi","Saharanpur","Salem","Shillong",
  "Siliguri","Solapur","Srinagar","Surat","Thiruvananthapuram","Tiruchirappalli","Udaipur",
  "Ujjain","Vadodara","Varanasi","Vijayawada","Visakhapatnam","Warangal"
];

export default function CitySearch({ value, onChange }) {
  const [query, setQuery] = useState(value || "");
  const [showList, setShowList] = useState(false);
  const wrapperRef = useRef(null);

  // Sync internal state if parent resets or shifts form values externally
  useEffect(() => {
    setQuery(value || "");
  }, [value]);

  const filtered = INDIAN_CITIES.filter((city) =>
    city.toLowerCase().startsWith(query.toLowerCase())
  );

  useEffect(() => {
    function handleClickOutside(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setShowList(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleSelect(city) {
    setQuery(city);
    onChange(city);
    setShowList(false);
  }

  return (
    <div ref={wrapperRef} className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          onChange(e.target.value);
          setShowList(true);
        }}
        onFocus={() => setShowList(true)}
        placeholder="Search city..."
        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500 placeholder-gray-500"
      />
      {showList && query.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-slate-800 border border-slate-600 rounded-lg max-h-40 overflow-y-auto shadow-xl">
          {filtered.length > 0 ? (
            filtered.map((city) => (
              <div
                key={city}
                onClick={() => handleSelect(city)}
                className="px-4 py-2 text-sm text-gray-300 hover:bg-orange-500/20 hover:text-orange-400 cursor-pointer transition-colors"
              >
                {city}
              </div>
            ))
          ) : (
            <div className="px-4 py-2 text-sm text-gray-500">No city found</div>
          )}
        </div>
      )}
    </div>
  );
}