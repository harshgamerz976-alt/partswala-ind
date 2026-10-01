import { useContext } from "react";
import { CartContext } from "./cartContext";

export const useCart = () => useContext(CartContext);